-- Phase 02 plan 02-02 (D-19): shop_created and onboarding_completed count as
-- vendor activity. A vendor who signed up today should read as active
-- today, not never-active — otherwise the activation funnel in the
-- analytics views silently loses the cohort that has only completed setup.
--
-- Additive-only (D-08 carried forward): reissues
-- private.refresh_last_active() with `create or replace function`, keeping
-- the body byte-identical except that the store-refresh allow-list gains
-- 'shop_created' and 'onboarding_completed' — ten names where there were
-- eight. `create or replace` keeps the same function identity (same OID),
-- so the events_refresh_last_active trigger created in
-- 20260923000900_events.sql keeps pointing at this function with no need to
-- drop or recreate it.

create or replace function private.refresh_last_active()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- D-11's eight meaningful-vendor-action names plus D-19's two signup
  -- events — merely opening the app does not count.
  if new.event_name in (
    'shop_created', 'onboarding_completed',
    'product_added', 'product_updated', 'product_marked_available',
    'product_marked_unavailable', 'offer_created', 'catalogue_shared',
    'offer_shared', 'orders_opened'
  ) then
    update public.stores set last_active_at = new.occurred_at where id = new.store_id;
  end if;

  if new.customer_id is not null then
    update public.customers set last_active_at = new.occurred_at where id = new.customer_id;
  end if;

  return new;
end;
$$;

-- Asserted, not just inherited: the grant posture is re-stated by this file
-- rather than relied upon implicitly.
revoke all on function private.refresh_last_active() from public;
