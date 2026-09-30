-- Phase 01.1 (beta data): the ten dashboard analytics views (DATA-09, D-10,
-- D-11, D-12, D-13, D-14, D-17). Additive-only migration — Phase 1's four
-- migration files are never edited (D-08). Every view here is a plain SQL
-- view — never materialised (D-12: always current, nothing to refresh, and
-- beta scale is tens of shops) — and lives in the `private` schema (D-17),
-- which is already excluded from `supabase/config.toml`'s `[api] schemas`
-- and already carries `revoke all on schema private from public; grant usage
-- on schema private to anon, authenticated;` (20260922000100_schema.sql).
-- That existing posture is what makes every view here unreachable from a
-- browser session: usage on the schema lets anon/authenticated resolve
-- `private.<view>` by name, but with no object-level grant added anywhere in
-- this file, a direct select as either role fails with SQLSTATE 42501 by
-- construction (D-13) — not because of a revoke that could later be
-- reversed. No `grant` statement appears anywhere below; that is
-- deliberate, not an omission.
--
-- Every view is also created `with (security_invoker = true)`, following the
-- public_stores precedent (20260922000100_schema.sql). Two reasons even
-- inside a schema nobody outside `postgres` can reach: it keeps the blocking
-- `security_definer_view` advisor from firing at all, and it means any
-- future reader is still subject to the underlying tables' RLS rather than
-- the view owner's privileges.
--
-- These views are read only through the Supabase dashboard's SQL editor,
-- which connects as `postgres` (owns every schema, bypasses RLS) — exactly
-- how `private.owned_store_id()` is read today.
--
-- Every reference is schema-qualified throughout.

-- ── event_actors: the actor normalisation named once, reused below ─────────
-- Plan 01.1-03's assumption-delta decision: public.events carries three
-- nullable identity columns (user_id, customer_id, visitor_id) rather than
-- one normalised actor. This view projects the one-noun actor every other
-- view groups on, so no other view repeats this CASE expression.
create view private.event_actors
with (security_invoker = true)
as
select
  e.id as event_id,
  e.store_id,
  e.occurred_at,
  e.event_name,
  e.app_version,
  case
    when e.user_id is not null then 'vendor'
    when e.customer_id is not null then 'customer'
    else 'visitor'
  end as actor_kind,
  coalesce(e.user_id::text, e.customer_id::text, e.visitor_id) as actor_key
from public.events e;

comment on view private.event_actors is
  'One row per event. actor_kind is vendor when user_id is present, customer '
  'when customer_id is present, otherwise visitor; actor_key is the '
  'corresponding identifier cast to text. Every other view that needs to '
  'group events by "who did this" reads actor_kind/actor_key from here '
  'rather than re-deriving the three-way identity.';

-- ── vendor_activation: D-10's activated-vendor definition ──────────────────
create view private.vendor_activation
with (security_invoker = true)
as
select
  s.id as store_id,
  s.created_at,
  exists (
    select 1 from public.events e
    where e.store_id = s.id and e.event_name = 'onboarding_completed'
  ) as has_completed_onboarding,
  exists (
    select 1 from public.products p
    where p.store_id = s.id and p.available
  ) as has_available_product,
  exists (
    select 1 from public.catalogue_shares cs
    where cs.store_id = s.id
  ) as has_shared_catalogue
from public.stores s;

comment on view private.vendor_activation is
  'D-10: an activated vendor is one who completed setup AND has at least one '
  'available product AND has at least one catalogue share — a shared empty '
  'catalogue is not a live catalogue. has_completed_onboarding reads false '
  'for every store until AUTH-03/DATA-04 emits the onboarding_completed '
  'event in Phase 2; that is the correct, expected state for this phase, '
  'not a defect in this view.';

-- ── vendor_daily_activity: D-11's active-vendor-on-a-day definition ────────
create view private.vendor_daily_activity
with (security_invoker = true)
as
select distinct
  ea.store_id,
  ea.occurred_at::date as activity_date
from private.event_actors ea
where ea.actor_kind = 'vendor'
  and ea.event_name in (
    'product_added', 'product_updated', 'product_marked_available',
    'product_marked_unavailable', 'offer_created', 'catalogue_shared',
    'offer_shared', 'orders_opened'
  );

comment on view private.vendor_daily_activity is
  'D-11: active vendor (on a day) = performed at least one meaningful '
  'action: product added/updated, availability flipped, offer created, '
  'catalogue/product shared, or orders list opened. Merely opening the app '
  'does not count. One (store_id, activity_date) row exists here for each '
  'day the vendor performed at least one of those eight actions.';

-- ── vendor_retention: D-14's D1/D7/D14/D30 vendor windows ──────────────────
create view private.vendor_retention
with (security_invoker = true)
as
with cohort as (
  select id as store_id, created_at::date as cohort_date from public.stores
)
select
  c.store_id,
  c.cohort_date,
  bool_or(a.activity_date = c.cohort_date + 1)  as retained_d1,
  bool_or(a.activity_date = c.cohort_date + 7)  as retained_d7,
  bool_or(a.activity_date = c.cohort_date + 14) as retained_d14,
  bool_or(a.activity_date = c.cohort_date + 30) as retained_d30
from cohort c
left join private.vendor_daily_activity a on a.store_id = c.store_id
group by c.store_id, c.cohort_date;

comment on view private.vendor_retention is
  'D-14: one row per vendor, cohort_date is the store''s signup date. '
  'retained_dN is true iff the vendor had at least one D-11 meaningful-'
  'action day exactly N days after signup. A cohort younger than N days '
  'reads false for retained_dN because that day has not happened yet — the '
  'dashboard query, not this view, is responsible for excluding immature '
  'cohorts. Reading a naive COUNT across all rows here understates '
  'retention; read the boolean columns filtered by cohort age instead.';

-- ── customer_funnel: doc §4, counts and distinct customers ─────────────────
create view private.customer_funnel
with (security_invoker = true)
as
select
  count(*) filter (where event_name = 'catalogue_opened') as catalogues_opened,
  count(*) filter (where event_name = 'product_viewed')   as products_viewed,
  count(*) filter (where event_name = 'add_to_cart')      as carts_started,
  count(*) filter (where event_name = 'checkout_started') as checkouts_started,
  count(*) filter (where event_name = 'order_placed')     as orders_placed,
  count(distinct visitor_id) filter (where event_name = 'catalogue_opened') as catalogues_opened_visitors,
  count(distinct visitor_id) filter (where event_name = 'product_viewed')   as products_viewed_visitors,
  count(distinct visitor_id) filter (where event_name = 'add_to_cart')      as carts_started_visitors,
  count(distinct visitor_id) filter (where event_name = 'checkout_started') as checkouts_started_visitors,
  count(distinct visitor_id) filter (where event_name = 'order_placed')    as orders_placed_visitors
from public.events;

comment on view private.customer_funnel is
  'doc §4 customer funnel: catalogue opened -> product viewed -> cart '
  'started -> checkout started -> order placed, as raw event counts and as '
  'counts of distinct visitor_id — doc §16 questions 5-7 ask "how many '
  'customers", not "how many events", so the *_visitors columns are the '
  'ones that answer those questions in distinct people.';

-- ── customer_retention: D-14's customer half, repeat orders per shop ───────
create view private.customer_retention
with (security_invoker = true)
as
select
  store_id,
  customer_id,
  count(*)            as order_count,
  min(created_at)      as first_order_at,
  max(created_at)      as last_order_at,
  count(*) > 1         as is_repeat
from public.orders
where customer_id is not null
group by store_id, customer_id;

comment on view private.customer_retention is
  'D-14''s customer-retention half: one row per (store_id, customer_id), '
  'is_repeat is true when that customer has placed more than one order at '
  'that shop. Orders placed before DATA-01 upserted customers (or any order '
  'whose customer_id could not be resolved) are excluded, not counted as a '
  'single-order customer.';

-- ── order_outcomes: orders by status, per store and as a grand total ───────
create view private.order_outcomes
with (security_invoker = true)
as
select
  store_id,
  count(*) filter (where status = 'new')       as orders_new,
  count(*) filter (where status = 'confirmed') as orders_confirmed,
  count(*) filter (where status = 'cancelled') as orders_cancelled,
  count(*) filter (where status = 'completed') as orders_completed,
  count(*) filter (where total is not null)    as orders_priced
from public.orders
group by rollup (store_id);

comment on view private.order_outcomes is
  'Orders grouped by status, one row per store plus a final grand-total row '
  'where store_id is null (group by rollup). orders_priced counts orders '
  'whose total is non-null — total stays null for nearly every order until '
  'PROD-03 ships the products.price form field in Phase 3, which is the '
  'documented expected state, not a defect.';

-- ── offer_activity: doc §10's offers created/shared line ───────────────────
create view private.offer_activity
with (security_invoker = true)
as
with created as (
  select store_id, created_at::date as activity_date, count(*) as offers_created
  from public.offers
  group by store_id, created_at::date
),
shared as (
  select store_id, occurred_at::date as activity_date, count(*) as offers_shared
  from public.events
  where event_name = 'offer_shared'
  group by store_id, occurred_at::date
)
select
  coalesce(c.store_id, s.store_id)         as store_id,
  coalesce(c.activity_date, s.activity_date) as activity_date,
  coalesce(c.offers_created, 0)            as offers_created,
  coalesce(s.offers_shared, 0)             as offers_shared
from created c
full outer join shared s
  on s.store_id = c.store_id and s.activity_date = c.activity_date;

comment on view private.offer_activity is
  'doc §10''s offers created/shared line, per store per day. A day with a '
  'share but no creation (or vice versa) still produces one row via the '
  'full outer join, with the missing side reading 0 rather than being '
  'silently omitted.';

-- ── release_comparison: doc §16 question 10, doc §7's purpose ──────────────
create view private.release_comparison
with (security_invoker = true)
as
select
  app_version,
  min(occurred_at) as first_seen_at,
  max(occurred_at) as last_seen_at,
  count(distinct store_id)   as stores_seen,
  count(distinct visitor_id) as visitors_seen,
  count(*) filter (where event_name = 'catalogue_opened') as catalogues_opened,
  count(*) filter (where event_name = 'product_viewed')   as products_viewed,
  count(*) filter (where event_name = 'add_to_cart')      as carts_started,
  count(*) filter (where event_name = 'checkout_started') as checkouts_started,
  count(*) filter (where event_name = 'order_placed')     as orders_placed
from public.events
where app_version is not null
group by app_version;

comment on view private.release_comparison is
  'doc §16 question 10 / doc §7: one row per app_version, with the same '
  'funnel counts as customer_funnel so a release can be linked to the '
  'behaviour that followed it. app_version is plain text and is never '
  'parsed as semver (a build can ship "0.1.0-beta", "0.1.10", "0.2.0" in '
  'any order) — order the dashboard query by first_seen_at, never by the '
  'app_version string.';

-- ── beta_kpi_summary: one row, one number per headline metric ──────────────
create view private.beta_kpi_summary
with (security_invoker = true)
as
select
  (select count(*) from public.stores) as vendors_registered,
  (select count(*) from private.vendor_activation where has_completed_onboarding) as vendors_setup_completed,
  (select count(*) from private.vendor_activation
    where has_completed_onboarding and has_available_product and has_shared_catalogue) as vendors_activated,
  (select count(*) from public.products) as products_created,
  (select count(*) from public.catalogue_shares) as catalogues_shared,
  (select count(*) from public.customers) as customers_recorded,
  (select count(*) from public.events where event_name = 'catalogue_opened') as catalogue_views,
  (select count(*) from public.events where event_name = 'product_viewed') as product_views,
  (select count(*) from public.events where event_name = 'add_to_cart') as carts_started,
  (select count(*) from public.orders) as orders_placed,
  (select count(*) from public.orders where status = 'confirmed') as orders_confirmed,
  (select count(*) from public.orders where status = 'cancelled') as orders_cancelled,
  (select count(*) from public.offers) as offers_created;

comment on view private.beta_kpi_summary is
  'doc §14 / §16: one row, one number per headline metric, for the '
  'dashboard''s landing query. vendors_activated is the D-10 conjunction '
  'and reads 0 for every store until AUTH-03/DATA-04 ships '
  'has_completed_onboarding in Phase 2 — expected, not a defect.';
