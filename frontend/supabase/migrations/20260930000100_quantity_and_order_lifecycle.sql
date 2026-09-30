alter table public.order_items drop constraint if exists order_items_qty_check;
alter table public.order_items alter column qty type numeric(10,2) using qty::numeric;
alter table public.order_items add constraint order_items_qty_check check (qty >= 0.5 and qty <= 99 and qty * 2 = trunc(qty * 2));

create or replace function private.guard_order_status_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = old.status then return new; end if;
  if old.status = 'new' and new.status = 'confirmed' then new.confirmed_at := coalesce(new.confirmed_at, now()); return new; end if;
  if old.status = 'new' and new.status = 'cancelled' then new.cancelled_at := coalesce(new.cancelled_at, now()); return new; end if;
  if old.status = 'confirmed' and new.status = 'completed' then new.completed_at := coalesce(new.completed_at, now()); return new; end if;
  raise exception 'invalid_order_status_transition' using errcode = 'P0001';
end;
$$;
revoke all on function private.guard_order_status_transition() from public;
grant execute on function private.guard_order_status_transition() to authenticated;
drop trigger if exists orders_guard_status_transition on public.orders;
create trigger orders_guard_status_transition before update of status on public.orders for each row execute function private.guard_order_status_transition();
