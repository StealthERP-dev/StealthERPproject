-- pgTAP: the order lifecycle (ORDR-05/D-01, ORDR-06) — Confirm/Cancel writes
-- through the already-shipped "orders: owner updates" policy (no new policy,
-- no new grant, no new RPC), the preset-code CHECK constraint's rejection
-- and its dependence on the constraint's own existence, the is_new/status
-- orthogonality (D-12's premise) as a database fact in both directions, and
-- the mark-seen bulk update's row scope. Fixtures are built as postgres
-- (bypasses RLS), own fixture prefix (24000000-…), distinct from every
-- other file's. One store, one product, three orders — reused across every
-- case below rather than one-order-per-case, so the orthogonality and
-- mark-seen assertions can observe how the SAME rows behave across several
-- writes, which a fresh order per case could not show.
--
-- Falsifiability requirement, recorded per the 019_offers_upsert_and_expiry.sql
-- convention (pgTAP cannot automate its own falsification):
--
-- 1. Case 3's constraint-rejection assertion below was, in a separate run of
--    this suite, checked against a database with the CHECK constraint
--    dropped by hand (`alter table public.orders drop constraint
--    <name>;` against the running local database, no file changed). Against
--    that database, the same misspelled-code write this file asserts
--    REJECTED with 23514 instead went GREEN — the update succeeded — which
--    confirms the assertion actually depends on the constraint's existence
--    and is not merely asserting that a fixture's typo is a typo. The
--    constraint was then restored by re-running `supabase db reset` (which
--    re-applies the migration) and this file passed green again. See the
--    plan's SUMMARY for the observed output of both runs.
-- 2. The migration this file exercises (20260927000100_order_rejection_reason.sql)
--    was itself run once in a deliberately wrong form — the new
--    order_outcomes column inserted BETWEEN orders_cancelled and
--    orders_completed, the form RESEARCH's own Pattern 6 proposed — and
--    `supabase db reset` failed with Postgres's own
--    cannot-change-view-column rejection (42P16) rather than applying. The
--    migration was then restored to its shipped, append-only form and the
--    reset passed green again. See the plan's SUMMARY for both transcripts.

begin;

select plan(20);

-- ── Fixture (as postgres, bypasses RLS) ─────────────────────────────────────
select tests.create_supabase_user('vendor_ol_a', 'vendor_ol_a@test.local');

insert into public.stores (id, owner_id, phone, shop_name, vendor_name, slug, business_types, is_open) values
  ('24000000-0000-4000-8000-000000000001', tests.get_supabase_uid('vendor_ol_a'),
    '9500000001', 'Order Lifecycle Shop', 'Vendor Order Lifecycle', 'order-lifecycle-shop', array['Vegetables'], true);

insert into public.products (id, store_id, name, unit, available) values
  ('24000000-0000-4000-8000-000000000010', '24000000-0000-4000-8000-000000000001',
    'Lifecycle Product', 'kg', true);

-- Order A: the Confirm case, and later the orthogonality case's "different
-- order" whose is_new must stay untouched by confirming a status change.
-- Order B: the Cancel case, including the constraint-rejection sub-case.
-- Order C: the orthogonality case's own is_new-cleared order.
insert into public.orders (id, store_id, customer_name, customer_phone, note) values
  ('24000000-0000-4000-8000-000000000040', '24000000-0000-4000-8000-000000000001', 'Confirm Customer', '9400000040', 'Customer note untouched by confirm'),
  ('24000000-0000-4000-8000-000000000041', '24000000-0000-4000-8000-000000000001', 'Cancel Customer', '9400000041', 'Customer note untouched by cancel'),
  ('24000000-0000-4000-8000-000000000042', '24000000-0000-4000-8000-000000000001', 'Ortho Customer', '9400000042', null);

-- ── As the owning vendor, through "orders: owner updates" ───────────────────
select tests.authenticate_as('vendor_ol_a');

-- 1. Confirming: status + confirmed_at set in one statement; the
--    cancellation columns stay null on a confirmed order.
with x as (
  update public.orders
  set status = 'confirmed', confirmed_at = now()
  where id = '24000000-0000-4000-8000-000000000040'
  returning 1
)
select is((select count(*)::int from x), 1, 'confirm: the owner-scoped update affects the one targeted row');

select is(
  (select status from public.orders where id = '24000000-0000-4000-8000-000000000040'),
  'confirmed', 'confirm: status reads back confirmed'
);
select isnt(
  (select confirmed_at from public.orders where id = '24000000-0000-4000-8000-000000000040'),
  null, 'confirm: confirmed_at is non-null'
);
select is(
  (select rejection_reason from public.orders where id = '24000000-0000-4000-8000-000000000040'),
  null, 'confirm: rejection_reason stays null on a confirmed order'
);
select is(
  (select rejection_note from public.orders where id = '24000000-0000-4000-8000-000000000040'),
  null, 'confirm: rejection_note stays null on a confirmed order'
);

-- 2. The constraint: an update writing a code outside the four approved
--    values is rejected with 23514, asserted by error code, never by
--    message text. Then the same order, written with a correctly-spelled
--    code plus the full cancel write, succeeds.
select throws_ok(
  $$ update public.orders set rejection_reason = 'out_of_stok' where id = '24000000-0000-4000-8000-000000000041' $$,
  '23514', null,
  'a misspelled preset code is rejected by the CHECK constraint with 23514, not stored and silently uncounted'
);
select is(
  (select rejection_reason from public.orders where id = '24000000-0000-4000-8000-000000000041'),
  null, 'the rejected write left rejection_reason untouched (still null)'
);

-- 3. Cancelling: status + cancelled_at + rejection_reason + rejection_note
--    all set in one statement, with a correctly-spelled code; the
--    CUSTOMER's own note column stays unchanged — asserted explicitly,
--    because "the vendor's note landed in the customer's column" is a
--    defect that leaves every screen looking correct.
with x as (
  update public.orders
  set status = 'cancelled', cancelled_at = now(),
      rejection_reason = 'out_of_stock', rejection_note = 'Ran out this morning'
  where id = '24000000-0000-4000-8000-000000000041'
  returning 1
)
select is((select count(*)::int from x), 1, 'cancel: the owner-scoped update affects the one targeted row');

select is(
  (select status from public.orders where id = '24000000-0000-4000-8000-000000000041'),
  'cancelled', 'cancel: status reads back cancelled'
);
select isnt(
  (select cancelled_at from public.orders where id = '24000000-0000-4000-8000-000000000041'),
  null, 'cancel: cancelled_at is non-null'
);
select is(
  (select rejection_reason from public.orders where id = '24000000-0000-4000-8000-000000000041'),
  'out_of_stock', 'cancel: rejection_reason reads back the KPI-bearing preset code'
);
select is(
  (select rejection_note from public.orders where id = '24000000-0000-4000-8000-000000000041'),
  'Ran out this morning', 'cancel: rejection_note reads back the vendor''s free text'
);
select is(
  (select note from public.orders where id = '24000000-0000-4000-8000-000000000041'),
  'Customer note untouched by cancel',
  'cancel: the CUSTOMER''s own note column is untouched by the vendor''s cancellation write'
);

-- 4. Orthogonality (D-12's premise), as a database fact, both directions.
--    Direction 1 — clear is_new on order C, leave its status untouched.
with x as (
  update public.orders set is_new = false
  where id = '24000000-0000-4000-8000-000000000042'
  returning 1
)
select is((select count(*)::int from x), 1, 'orthogonality: the owner clears is_new on the ortho order');
select is(
  (select status from public.orders where id = '24000000-0000-4000-8000-000000000042'),
  'new', 'orthogonality: status is still the unconfirmed default after is_new was cleared — the two columns did not move together'
);
select is(
  (select is_new from public.orders where id = '24000000-0000-4000-8000-000000000042'),
  false, 'orthogonality: is_new reads back false'
);

--    Direction 2 — order A (confirmed in case 1) never had is_new touched.
select is(
  (select is_new from public.orders where id = '24000000-0000-4000-8000-000000000040'),
  true, 'orthogonality: confirming order A never touched its is_new — it is still true'
);

-- 5. The mark-seen bulk update's row scope: an owner-scoped update clearing
--    is_new for every currently-unseen row of this store affects exactly
--    the expected number of rows (order A and order B — order C was
--    already cleared in case 4), and re-running it affects zero.
with x as (
  update public.orders set is_new = false
  where store_id = '24000000-0000-4000-8000-000000000001' and is_new = true
  returning 1
)
select is((select count(*)::int from x), 2, 'mark-seen: the bulk clear affects exactly the two still-unseen rows of this store (A and B — C was already cleared)');

select is(
  (select count(*)::int from public.orders where store_id = '24000000-0000-4000-8000-000000000001' and is_new = true),
  0, 'mark-seen: no row in this store now reads is_new = true'
);

with x as (
  update public.orders set is_new = false
  where store_id = '24000000-0000-4000-8000-000000000001' and is_new = true
  returning 1
)
select is((select count(*)::int from x), 0, 'mark-seen: re-running the same bulk clear affects zero rows');

select * from finish();

rollback;
