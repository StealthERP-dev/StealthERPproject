-- pgTAP: the eleven private-schema analytics views (DATA-09, D-10..D-14,
-- D-17, DATA-11/D-14 for vendor_update_latency, grown in phase 03-01).
-- Fixtures are built as postgres (bypasses RLS) against a deliberately small,
-- fully known fixture: two vendors/stores (store A gets one available
-- product, one catalogue share, one customer with two differently-statused
-- orders, and a handful of events spanning the vendor and customer funnels
-- across two app versions; store B gets a store row and nothing else).
--
-- seed.sql's demo shop ("Priya Stores") is present throughout this test
-- (loaded by `supabase db reset` outside any test transaction, so it is not
-- rolled back between files) and seeds stores/products/offers/orders rows of
-- its own. Every assertion below is therefore either scoped to a fixture
-- store_id (unaffected by another store's rows) or, for the genuinely
-- genuinely global views (beta_kpi_summary, customer_funnel,
-- release_comparison), computed as a delta against a baseline snapshot taken
-- before this file's fixture inserts — never a hardcoded absolute that assumes
-- seed.sql, or a previously-run HTTP suite, contributes zero rows.

begin;

select plan(33);

-- ── Fixtures (as postgres, bypasses RLS) ────────────────────────────────────
select tests.create_supabase_user('vendor_av_a', 'vendor_av_a@test.local');
select tests.create_supabase_user('vendor_av_b', 'vendor_av_b@test.local');

-- Snapshot the genuinely global one-row beta_kpi_summary BEFORE this file's
-- fixture inserts (before either store exists), so the fields seed.sql's
-- demo shop also contributes to (vendors_registered, products_created,
-- orders_placed, offers_created) can be asserted as an exact delta rather
-- than a seed-fragile absolute.
create temporary table baseline as
select * from private.beta_kpi_summary;

-- Same reasoning for the two other genuinely global views this file asserts
-- on. seed.sql seeds zero events, but the HTTP suites (tests/db/*.test.mjs)
-- legitimately insert events against the same local database, so an absolute
-- count here is order-dependent. Snapshot them too and assert deltas.
create temporary table baseline_funnel as
select * from private.customer_funnel;

create temporary table baseline_releases as
select count(*)::int as row_count from private.release_comparison;
-- (kept for symmetry with the funnel baseline; the release assertion below
-- scopes by app_version rather than differencing this count.)

-- Store A "signs up" on a fixed past date so retained_d1/d7/d14/d30 are
-- deterministic regardless of when this test actually runs.
insert into public.stores (id, owner_id, phone, shop_name, vendor_name, slug, business_types, is_open, created_at) values
  ('80000000-0000-4000-8000-000000000001', tests.get_supabase_uid('vendor_av_a'),
    '9800000301', 'Analytics Shop A', 'Vendor Analytics A', 'analytics-shop-a', array['Vegetables'], true,
    '2026-08-01T00:00:00Z');
insert into public.stores (id, owner_id, phone, shop_name, vendor_name, slug, business_types, is_open) values
  ('80000000-0000-4000-8000-000000000002', tests.get_supabase_uid('vendor_av_b'),
    '9800000302', 'Analytics Shop B', 'Vendor Analytics B', 'analytics-shop-b', array['Vegetables'], true);

insert into public.categories (id, store_id, name) values
  ('80000000-0000-4000-8000-000000000010', '80000000-0000-4000-8000-000000000001', 'Analytics Category A');

insert into public.products (id, store_id, name, category_id, unit, available) values
  ('80000000-0000-4000-8000-000000000020', '80000000-0000-4000-8000-000000000001',
    'Analytics Product A', '80000000-0000-4000-8000-000000000010', 'kg', true);

insert into public.catalogue_shares (store_id, share_type, destination) values
  ('80000000-0000-4000-8000-000000000001', 'catalogue', 'whatsapp');

insert into public.customers (id, store_id, phone, name) values
  ('80000000-0000-4000-8000-000000000030', '80000000-0000-4000-8000-000000000001', '9800000399', 'Analytics Customer');

insert into public.orders (id, store_id, customer_id, customer_name, customer_phone, status) values
  ('80000000-0000-4000-8000-000000000040', '80000000-0000-4000-8000-000000000001',
    '80000000-0000-4000-8000-000000000030', 'Analytics Customer', '9800000399', 'new'),
  ('80000000-0000-4000-8000-000000000041', '80000000-0000-4000-8000-000000000001',
    '80000000-0000-4000-8000-000000000030', 'Analytics Customer', '9800000399', 'confirmed');

insert into public.offers (store_id, product_id, today_price_label, offer_date) values
  ('80000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000020', '₹10/kg', public.today_ist());

-- Vendor-side events. shop_created is deliberately NOT in D-11's eight-name
-- subset (proves a non-meaningful event creates no vendor_daily_activity
-- row); product_added is in the subset, dated exactly one day after
-- signup (proves retained_d1).
insert into public.events (event_name, store_id, user_id, app_version, occurred_at) values
  ('shop_created', '80000000-0000-4000-8000-000000000001', tests.get_supabase_uid('vendor_av_a'),
    '0.1.0-beta', '2026-08-01T00:00:00Z'),
  ('product_added', '80000000-0000-4000-8000-000000000001', tests.get_supabase_uid('vendor_av_a'),
    '0.1.0-beta', '2026-08-02T00:00:00Z');

-- Customer-side events spanning the funnel, two distinct visitors, two
-- distinct app versions. visitor-1 walks the full funnel on 0.1.0-beta;
-- visitor-2 only opens the catalogue, on 0.2.0.
insert into public.events (event_name, store_id, visitor_id, app_version, order_id) values
  ('catalogue_opened', '80000000-0000-4000-8000-000000000001', 'analytics-visitor-1', '0.1.0-beta', null),
  ('catalogue_opened', '80000000-0000-4000-8000-000000000001', 'analytics-visitor-2', '0.2.0', null),
  ('product_viewed',   '80000000-0000-4000-8000-000000000001', 'analytics-visitor-1', '0.1.0-beta', null),
  ('add_to_cart',      '80000000-0000-4000-8000-000000000001', 'analytics-visitor-1', '0.1.0-beta', null),
  ('checkout_started', '80000000-0000-4000-8000-000000000001', 'analytics-visitor-1', '0.1.0-beta', null),
  ('order_placed',     '80000000-0000-4000-8000-000000000001', 'analytics-visitor-1', '0.1.0-beta',
    '80000000-0000-4000-8000-000000000040');

-- ── Isolation (as postgres — has_table_privilege/reloptions don't depend on
--    the calling role, so no role switch is needed for these) ─────────────

-- 1. neither anon nor authenticated holds select on any of the eleven views
select is(
  (
    select count(*)::int
    from (values
      ('event_actors'), ('vendor_activation'), ('vendor_daily_activity'), ('vendor_retention'),
      ('customer_funnel'), ('customer_retention'), ('order_outcomes'), ('offer_activity'),
      ('release_comparison'), ('beta_kpi_summary'), ('vendor_update_latency')
    ) as t (view_name)
    where has_table_privilege('anon', 'private.' || t.view_name, 'select')
  ),
  0,
  'anon has select privilege on none of the eleven private analytics views'
);
select is(
  (
    select count(*)::int
    from (values
      ('event_actors'), ('vendor_activation'), ('vendor_daily_activity'), ('vendor_retention'),
      ('customer_funnel'), ('customer_retention'), ('order_outcomes'), ('offer_activity'),
      ('release_comparison'), ('beta_kpi_summary'), ('vendor_update_latency')
    ) as t (view_name)
    where has_table_privilege('authenticated', 'private.' || t.view_name, 'select')
  ),
  0,
  'authenticated has select privilege on none of the eleven private analytics views'
);

-- 2. every one of the eleven views carries security_invoker=true
select is(
  (
    select count(*)::int
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'private'
      and c.relkind = 'v'
      and c.relname in (
        'event_actors', 'vendor_activation', 'vendor_daily_activity', 'vendor_retention',
        'customer_funnel', 'customer_retention', 'order_outcomes', 'offer_activity',
        'release_comparison', 'beta_kpi_summary', 'vendor_update_latency'
      )
      and not ('security_invoker=true' = any(coalesce(c.reloptions, array[]::text[])))
  ),
  0,
  'all eleven private analytics views carry security_invoker=true'
);

-- ── Correctness: one assertion per doc §16 question, enforcing the
--    view_to_question_map (still as postgres) ──────────────────────────────

-- Q1: vendors registered (beta_kpi_summary.vendors_registered) — delta, not
-- absolute, because seed.sql's demo shop also contributes a row.
select is(
  ((select vendors_registered from private.beta_kpi_summary) - (select vendors_registered from baseline))::int,
  2,
  'beta_kpi_summary.vendors_registered increases by exactly 2 for the two seeded vendors'
);

-- Q2: completed setup (beta_kpi_summary.vendors_setup_completed) — a delta,
-- not an absolute. This assertion was originally an absolute 0 on the
-- premise that no onboarding_completed event existed anywhere; its own
-- comment flagged that as a "Phase 2 dependency". Phase 2 shipped that
-- event, and tests/db/log-event.test.mjs now exercises the signed-in branch
-- with it, so the absolute form failed whenever the HTTP suite had already
-- run against this database. Differenced against the same pre-fixture
-- baseline the other global-view assertions use: this file's own fixtures
-- insert no onboarding_completed event, so the delta is 0 no matter what
-- ran before it.
select is(
  ((select vendors_setup_completed from private.beta_kpi_summary) - (select vendors_setup_completed from baseline))::int,
  0,
  'beta_kpi_summary.vendors_setup_completed is unchanged by this file''s fixtures (none emit onboarding_completed)'
);

-- Q3: published catalogue (vendor_activation.has_available_product)
select is(
  (select has_available_product from private.vendor_activation where store_id = '80000000-0000-4000-8000-000000000001'),
  true,
  'vendor_activation reports store A as having an available product'
);
select is(
  (select has_available_product from private.vendor_activation where store_id = '80000000-0000-4000-8000-000000000002'),
  false,
  'vendor_activation reports store B as having no available product'
);

-- Q4: shared it (vendor_activation.has_shared_catalogue / beta_kpi_summary.catalogues_shared)
select is(
  (select has_shared_catalogue from private.vendor_activation where store_id = '80000000-0000-4000-8000-000000000001'),
  true,
  'vendor_activation reports store A as having shared its catalogue'
);
select is(
  (select has_shared_catalogue from private.vendor_activation where store_id = '80000000-0000-4000-8000-000000000002'),
  false,
  'vendor_activation reports store B as having shared nothing'
);
select is(
  (select catalogues_shared::int from private.beta_kpi_summary),
  1,
  'beta_kpi_summary.catalogues_shared is 1 (seed.sql seeds none)'
);

-- Q5-7: customer funnel (private.customer_funnel is global — asserted as a
-- delta against the pre-fixture baseline so any events left behind by the
-- HTTP suites cannot make this file order-dependent)
select is(((select catalogues_opened from private.customer_funnel) - (select catalogues_opened from baseline_funnel))::int, 2, 'customer_funnel.catalogues_opened rises by 2');
select is(((select catalogues_opened_visitors from private.customer_funnel) - (select catalogues_opened_visitors from baseline_funnel))::int, 2, 'customer_funnel.catalogues_opened_visitors rises by 2 (two distinct visitors)');
select is(((select products_viewed from private.customer_funnel) - (select products_viewed from baseline_funnel))::int, 1, 'customer_funnel.products_viewed rises by 1');
select is(((select products_viewed_visitors from private.customer_funnel) - (select products_viewed_visitors from baseline_funnel))::int, 1, 'customer_funnel.products_viewed_visitors rises by 1');
select is(((select carts_started from private.customer_funnel) - (select carts_started from baseline_funnel))::int, 1, 'customer_funnel.carts_started rises by 1');
select is(((select carts_started_visitors from private.customer_funnel) - (select carts_started_visitors from baseline_funnel))::int, 1, 'customer_funnel.carts_started_visitors rises by 1');

-- Q8: orders placed (customer_funnel.orders_placed / order_outcomes.orders_new)
select is(((select orders_placed from private.customer_funnel) - (select orders_placed from baseline_funnel))::int, 1, 'customer_funnel.orders_placed rises by 1');
select is(
  (select orders_new::int from private.order_outcomes where store_id = '80000000-0000-4000-8000-000000000001'),
  1,
  'order_outcomes reports 1 new order for store A'
);
select is(
  (select orders_confirmed::int from private.order_outcomes where store_id = '80000000-0000-4000-8000-000000000001'),
  1,
  'order_outcomes reports 1 confirmed order for store A'
);
select is(
  (select orders_cancelled::int from private.order_outcomes where store_id = '80000000-0000-4000-8000-000000000001'),
  0,
  'order_outcomes reports 0 cancelled orders for store A'
);

-- Q9: vendor returned (vendor_daily_activity + vendor_retention)
select is(
  (select count(*)::int from private.vendor_daily_activity where store_id = '80000000-0000-4000-8000-000000000001'),
  1,
  'vendor_daily_activity has exactly one row for store A (the product_added day) — shop_created (outside D-11''s subset) creates none'
);
select is(
  (select count(*)::int from private.vendor_daily_activity where store_id = '80000000-0000-4000-8000-000000000002'),
  0,
  'vendor_daily_activity has no rows for store B'
);
select is(
  (select count(*)::int from private.vendor_daily_activity
    where store_id = '80000000-0000-4000-8000-000000000001' and activity_date = '2026-08-01'),
  0,
  'shop_created (outside D-11''s eight-name subset) does not create a vendor_daily_activity row on its own day'
);
select is(
  (select retained_d1 from private.vendor_retention where store_id = '80000000-0000-4000-8000-000000000001'),
  true,
  'vendor_retention reports store A retained_d1 = true (meaningful action exactly one day after signup)'
);
select is(
  (select retained_d7 from private.vendor_retention where store_id = '80000000-0000-4000-8000-000000000001'),
  false,
  'vendor_retention reports store A retained_d7 = false (no activity 7 days after signup)'
);

-- Q10: release comparison (private.release_comparison is global — scoped to
-- this file's own two app versions, since an HTTP suite run earlier against
-- the same database may already have recorded 0.1.0-beta events)
select is(
  (select count(*)::int from private.release_comparison where app_version in ('0.1.0-beta', '0.2.0')),
  2,
  'release_comparison reports one row per app version for this file''s two versions'
);
select is(
  (
    select app_version from private.release_comparison
    where app_version in ('0.1.0-beta', '0.2.0')
    order by first_seen_at asc limit 1
  ),
  '0.1.0-beta',
  'release_comparison orders by first_seen_at, not the app_version string — 0.1.0-beta was first seen before 0.2.0'
);

-- Supporting view: customer_retention (D-14's customer half)
select is(
  (select is_repeat from private.customer_retention
    where store_id = '80000000-0000-4000-8000-000000000001'
      and customer_id = '80000000-0000-4000-8000-000000000030'),
  true,
  'customer_retention reports is_repeat = true for the customer with two orders'
);

-- Supporting view: offer_activity (doc §10). The view buckets by
-- created_at::date (session-timezone date), so compare against current_date,
-- not today_ist(): between 18:30-24:00 UTC the IST date is already tomorrow.
select is(
  (select offers_created::int from private.offer_activity
    where store_id = '80000000-0000-4000-8000-000000000001' and activity_date = current_date),
  1,
  'offer_activity counts the one seeded offer for store A today'
);

-- ── ORDR-06: order_outcomes' appended KPI column, on a mixed-reason fixture ──
-- Deliberately added HERE, after the "order_outcomes reports 0 cancelled
-- orders for store A" assertion above has already run and passed — that
-- assertion is left byte-for-byte unmodified, and these two new orders are
-- cancelled only after it already evaluated, so its recorded PASS reflects
-- the state at the time it ran, not the state after this block below. Two
-- orders, two DIFFERENT preset codes, so the appended column's own filter
-- can be told apart from the pre-existing orders_cancelled count: a column
-- that counted every cancellation regardless of reason would look correct
-- here and would make the Catalog Accuracy Score meaningless.
insert into public.orders (id, store_id, customer_id, customer_name, customer_phone, status) values
  ('80000000-0000-4000-8000-000000000042', '80000000-0000-4000-8000-000000000001',
    '80000000-0000-4000-8000-000000000030', 'Analytics Customer', '9800000399', 'new'),
  ('80000000-0000-4000-8000-000000000043', '80000000-0000-4000-8000-000000000001',
    '80000000-0000-4000-8000-000000000030', 'Analytics Customer', '9800000399', 'new');

update public.orders set status = 'cancelled', cancelled_at = now(), rejection_reason = 'out_of_stock'
  where id = '80000000-0000-4000-8000-000000000042';
update public.orders set status = 'cancelled', cancelled_at = now(), rejection_reason = 'mistake'
  where id = '80000000-0000-4000-8000-000000000043';

select is(
  (select orders_cancelled::int from private.order_outcomes where store_id = '80000000-0000-4000-8000-000000000001'),
  2,
  'order_outcomes.orders_cancelled now counts BOTH newly-cancelled orders, regardless of reason'
);
select is(
  (select orders_cancelled_stock_discrepancy::int from private.order_outcomes where store_id = '80000000-0000-4000-8000-000000000001'),
  1,
  'order_outcomes.orders_cancelled_stock_discrepancy counts only the out_of_stock cancellation, not the mistake one — the contrast that tells the two counts apart'
);

-- Structural: the six pre-existing columns keep their original ordinal
-- positions and the new one is seventh, read out of the information schema
-- rather than assumed — this is the gate that goes red if a future
-- migration ever tries the middle-insertion form again.
select is(
  (
    select string_agg(column_name, ',' order by ordinal_position)
    from information_schema.columns
    where table_schema = 'private' and table_name = 'order_outcomes'
  ),
  'store_id,orders_new,orders_confirmed,orders_cancelled,orders_completed,orders_priced,orders_cancelled_stock_discrepancy',
  'order_outcomes: the six pre-existing columns keep their original ordinal positions, and orders_cancelled_stock_discrepancy is seventh'
);

-- ── Isolation: a signed-in vendor cannot select from a representative view
--    (role switch — kept last so no later assertion needs to run as postgres) ──
select tests.authenticate_as('vendor_av_a');

select throws_ok(
  $$ select 1 from private.vendor_activation $$,
  '42501', null,
  'a signed-in vendor cannot select from private.vendor_activation — schema usage grants resolution, not read access'
);

select * from finish();

rollback;
