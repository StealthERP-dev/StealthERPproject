-- Phase 6 (order requests): this phase's ONE migration (D-01, ORDR-06).
-- Additive-only — all 17 previously-shipped migration files stay
-- byte-for-byte immutable, this is a new file. It does exactly three things:
--
-- 1. Confirms the live shape of private.order_outcomes before touching it
--    (this migration does not do that confirmation itself — Postgres SQL
--    files cannot introspect and branch — but the confirmation was run this
--    session, the same "confirm the live shape first" discipline
--    20260926000100_offer_catalogue_share_type.sql's own header models for
--    its constraint name). Read live via information_schema.columns before
--    this file was written:
--      store_id, orders_new, orders_confirmed, orders_cancelled,
--      orders_completed, orders_priced
--    Six columns after none (store_id is the group-by key). See the plan's
--    SUMMARY for the exact query and output. The view below appends its new
--    column strictly LAST, matching this observed order — Postgres's
--    `create or replace view` permits appending columns only; it rejects
--    renaming, reordering, or removing an existing one (42P16). RESEARCH's
--    own Pattern 6 proposed inserting the new column BETWEEN
--    orders_cancelled and orders_completed — that form was tried against
--    this live database as part of this task's required falsifiability run
--    and failed with exactly that rejection (transcript in the plan's
--    SUMMARY). This file uses the corrected, append-only form.
--
-- 2. Adds D-01's two columns to public.orders. `orders.note` is the
--    CUSTOMER's own note, written by place_order from p_note — it is never
--    reused, read, or written by anything in this phase, and this migration
--    touches it nowhere. The two new columns below are deliberately kept
--    separate rather than concatenated into one: `rejection_reason` is the
--    machine-countable preset code the client PRD §5 Catalog Accuracy Score
--    filters on (`= 'out_of_stock'`), and `rejection_note` is the vendor's
--    free text, never counted, never parsed. A single concatenated column
--    would put that KPI back into hand-classification, which is the exact
--    problem ORDR-06 exists to solve.
--
--    `rejection_reason` carries a CHECK constraint admitting null or exactly
--    the four codes the UI contract fixes (06-UI-SPEC.md Screen Contract 9's
--    REASONS array) — out_of_stock, customer_unreachable, mistake, other —
--    mirroring `orders.status`'s own four-value check
--    (20260923000700_beta_core_records.sql). This is the one-way-door
--    decision Task 1 of this plan asked the user to confirm; they chose
--    `constrain` on 2026-09-27. Without this constraint the only guarantee
--    that the KPI's filter counts anything is "the client happens to send
--    four correctly-spelled strings" — an assertion that cannot fail. With
--    it, a typo'd code is rejected by the database with error code 23514
--    rather than stored and silently uncounted (proven in
--    supabase/tests/024_order_lifecycle.sql and
--    tests/db/order-lifecycle.test.mjs, and proven to actually depend on
--    the constraint's existence, not merely on a fixture's correct
--    spelling, by this task's second required falsifiability run — see the
--    plan's SUMMARY).
--
-- 3. Replaces private.order_outcomes, keeping its six existing columns in
--    their exact names, types and ordinal positions, and appending a
--    seventh: orders_cancelled_stock_discrepancy, isolating the one
--    cancellation reason the Catalog Accuracy Score actually counts from
--    every other cancellation reason. security_invoker = true and the
--    `group by rollup (store_id)` shape are both kept unchanged. The view's
--    own comment is re-issued so its description mentions the new column —
--    a stale comment on a widened view is the same class of misleading
--    artefact D-12 already caught once in this phase (a shipped code
--    comment arguing the opposite of what the code beneath it does).
--
-- No new RLS policy, grant, or security-definer function is added.
-- "orders: owner updates" (20260922000200_rls.sql) already permits every
-- write this phase makes to public.orders — Confirm, Cancel, and the
-- mark-seen bulk update all ride that one existing, row-scoped policy.
-- anon already holds no grant on public.orders at all (`revoke all on
-- public.orders from anon`, same file) and gains none here.

-- ── public.orders: D-01's two rejection columns ─────────────────────────────
alter table public.orders add column rejection_reason text
  check (
    rejection_reason is null
    or rejection_reason in ('out_of_stock', 'customer_unreachable', 'mistake', 'other')
  );

alter table public.orders add column rejection_note text;

-- ── private.order_outcomes: the KPI column, APPENDED last ──────────────────
create or replace view private.order_outcomes
with (security_invoker = true)
as
select
  store_id,
  count(*) filter (where status = 'new')       as orders_new,
  count(*) filter (where status = 'confirmed') as orders_confirmed,
  count(*) filter (where status = 'cancelled') as orders_cancelled,
  count(*) filter (where status = 'completed') as orders_completed,
  count(*) filter (where total is not null)    as orders_priced,
  count(*) filter (
    where status = 'cancelled' and rejection_reason = 'out_of_stock'
  ) as orders_cancelled_stock_discrepancy
from public.orders
group by rollup (store_id);

comment on view private.order_outcomes is
  'Orders grouped by status, one row per store plus a final grand-total row '
  'where store_id is null (group by rollup). orders_priced counts orders '
  'whose total is non-null — total stays null for nearly every order until '
  'PROD-03''s products.price form field is set on a line, which is the '
  'documented expected state, not a defect. orders_cancelled_stock_discrepancy '
  '(added 20260927000100, ORDR-06) is the subset of orders_cancelled whose '
  'rejection_reason is the KPI-bearing preset code out_of_stock — the client '
  'PRD §5 Catalog Accuracy Score reads this column, never orders_cancelled '
  'itself, because a plain cancellation count would conflate every '
  'cancellation reason and make the KPI meaningless. Appended as the seventh '
  'column, after orders_priced, because Postgres''s create or replace view '
  'permits appending columns only — inserting it next to orders_cancelled, '
  'where it conceptually belongs, would require renaming/reordering the '
  'existing orders_completed/orders_priced columns and is rejected with '
  '42P16 (observed live during this migration''s own falsifiability run, '
  'see the introducing plan''s SUMMARY).';
