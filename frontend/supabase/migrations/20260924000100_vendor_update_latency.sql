-- Phase 3 (catalogue management): DATA-11's vendor_update_latency view.
-- Additive-only migration — no existing migration file is edited (all 15
-- prior files are immutable). Creates exactly one object,
-- private.vendor_update_latency, copying 20260923001200_analytics_views.sql's
-- order_outcomes shape verbatim: security_invoker=true, grouped by rollup on
-- store_id, and no privilege statement anywhere in this file. The private
-- schema's existing revoke-from-public / usage-to-anon-authenticated posture
-- (20260922000100_schema.sql) is what makes a direct select from anon or
-- authenticated fail SQLSTATE 42501 by construction — not a privilege change
-- this file could later reverse.
--
-- D-14: a product with zero public.product_history rows (never manually
-- updated since it was made) is EXCLUDED from both the count and the three
-- interval aggregates below, never counted at zero latency and never
-- resolved from any other timestamp on the product row. The KPI asks how
-- stale the vendor's *maintenance* is; a product nobody has ever touched has
-- no "last manual update" to measure a latency from, and falling back to
-- when the row was made would conflate "freshly made, never needed an
-- update" with "made long ago and going stale". This is a discretionary
-- reading of the client PRD's KPI wording (CONTEXT.md D-14), recorded here
-- in the view's own comment — not only in a planning document — so a later
-- reinterpretation is a one-line change to this view's definition, with no
-- application-side consumer to update alongside it.
--
-- Every reference is schema-qualified throughout.

create view private.vendor_update_latency
with (security_invoker = true)
as
select
  p.store_id,
  count(*) as products_with_manual_update,
  avg(now() - p.updated_at) as avg_latency,
  min(now() - p.updated_at) as min_latency,
  max(now() - p.updated_at) as max_latency
from public.products p
where exists (
  select 1 from public.product_history ph where ph.product_id = p.id
)
group by rollup (p.store_id);

comment on view private.vendor_update_latency is
  'DATA-11: average/min/max time elapsed since each product''s last manual '
  'update, one row per store plus a final grand-total row (store_id is '
  'null). A product with no product_history row has never been manually '
  'updated since it was made and is EXCLUDED from every column here — it is '
  'never counted as zero latency and never falls back to any other '
  'timestamp on the product row. This exclusion is a discretionary reading '
  'of the KPI''s wording (D-14, phase 03 CONTEXT.md); it has no '
  'application-side consumer, so reinterpreting it later is a one-line '
  'change to this view definition.';
