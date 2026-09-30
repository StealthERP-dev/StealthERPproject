-- Phase 01.1 (beta data): place_order upserts the per-shop customer record
-- and computes the order total (DATA-01, D-01 carried-forward, D-08). This is
-- a `create or replace` of the exact function shipped in
-- 20260923000600_place_order_offer_label.sql (never edited — D-08); every
-- validation step, its ordering and errcode, and the security/hardening
-- decorator block are byte-identical. The only behavioral changes are: (1) a
-- customers upsert keyed on (store_id, phone) before the order insert, and
-- (2) the order now carries customer_id and a computed total.

create or replace function public.place_order(
  p_slug  text,
  p_name  text,
  p_phone text,
  p_note  text,
  p_items jsonb
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_name          text;
  v_phone         text;
  v_note          text;
  v_array_length  int;
  v_total_items   int;
  v_distinct_items int;
  v_item          jsonb;
  v_qty           numeric;
  v_store_id      uuid;
  v_is_open       boolean;
  v_lock_key      bigint;
  v_recent_count  int;
  v_customer_id   uuid;
  v_order_id      uuid;
  v_total         numeric;
begin
  -- a. name: btrim, null treated as empty; 2..100 chars
  v_name := btrim(coalesce(p_name, ''));
  if char_length(v_name) < 2 or char_length(v_name) > 100 then
    raise exception 'invalid_name' using errcode = 'P0001';
  end if;

  -- b. phone: strip every non-digit; 6..15 digits
  v_phone := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  if char_length(v_phone) < 6 or char_length(v_phone) > 15 then
    raise exception 'invalid_phone' using errcode = 'P0001';
  end if;

  -- c. note: btrim, empty becomes null; max 500 chars
  v_note := nullif(btrim(coalesce(p_note, '')), '');
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'invalid_note' using errcode = 'P0001';
  end if;

  -- d. items: JSON array of 1..50 objects, each with a UUID-format product_id
  --    (no duplicates) and a qty key. Extra keys (e.g. a client-supplied price
  --    or name) are ignored — they are never trusted.
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'invalid_items' using errcode = 'P0001';
  end if;

  v_array_length := jsonb_array_length(p_items);
  if v_array_length < 1 or v_array_length > 50 then
    raise exception 'invalid_items' using errcode = 'P0001';
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'invalid_items' using errcode = 'P0001';
    end if;

    if not (v_item ? 'product_id') or jsonb_typeof(v_item -> 'product_id') <> 'string' then
      raise exception 'invalid_items' using errcode = 'P0001';
    end if;

    begin
      perform (v_item ->> 'product_id')::uuid;
    exception when invalid_text_representation then
      raise exception 'invalid_items' using errcode = 'P0001';
    end;

    if not (v_item ? 'qty') then
      raise exception 'invalid_items' using errcode = 'P0001';
    end if;
  end loop;

  select count(*), count(distinct v.item ->> 'product_id')
    into v_total_items, v_distinct_items
    from jsonb_array_elements(p_items) as v (item);

  if v_total_items <> v_distinct_items then
    raise exception 'invalid_items' using errcode = 'P0001';
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    if jsonb_typeof(v_item -> 'qty') <> 'number' then
      raise exception 'invalid_qty' using errcode = 'P0001';
    end if;

    v_qty := (v_item ->> 'qty')::numeric;
    if v_qty <> trunc(v_qty) or v_qty < 1 or v_qty > 99 then
      raise exception 'invalid_qty' using errcode = 'P0001';
    end if;
  end loop;

  -- e. store: unknown slug or closed store
  select id, is_open into v_store_id, v_is_open
    from public.stores
    where slug = p_slug;

  if v_store_id is null then
    raise exception 'store_not_found' using errcode = 'P0001';
  end if;

  if not v_is_open then
    raise exception 'store_closed' using errcode = 'P0001';
  end if;

  -- f. serialize concurrent calls for the SAME (store, phone) only, before the
  --    rate-limit count — transaction-scoped, auto-releases on commit/rollback.
  v_lock_key := pg_catalog.hashtextextended(v_store_id::text || ':' || v_phone, 0);
  perform pg_catalog.pg_advisory_xact_lock(v_lock_key);

  -- g. rate limit: at most 5 orders per phone per store per rolling hour
  select count(*) into v_recent_count
    from public.orders
    where store_id = v_store_id
      and customer_phone = v_phone
      and created_at > now() - interval '1 hour';

  if v_recent_count >= 5 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  -- h. every product_id must be an available product belonging to this store.
  --    One code for unknown / other-store / unavailable products so other
  --    shops' catalogues are never revealed (T-02-05).
  if exists (
    select 1
    from jsonb_array_elements(p_items) as v (item)
    where not exists (
      select 1
      from public.products p
      where p.id = (v.item ->> 'product_id')::uuid
        and p.store_id = v_store_id
        and p.available = true
    )
  ) then
    raise exception 'item_unavailable' using errcode = 'P0001';
  end if;

  -- i. upsert the per-shop customer (BR8: identified per (store_id, phone),
  --    never globally by phone alone — doc §11). Using v_phone (already
  --    digits-only) is what makes a phone typed with a space and the same
  --    phone without one resolve to the same row.
  insert into public.customers (store_id, phone, name, last_active_at)
  values (v_store_id, v_phone, v_name, now())
  on conflict (store_id, phone) do update
    set name = excluded.name,
        last_active_at = now()
  returning id into v_customer_id;

  -- j. compute the order total. Unit price per line is the store's live
  --    today's offer_price if one exists, else the product's own price;
  --    both are numeric, so no float/double cast is ever introduced. A
  --    single unpriceable line makes the whole total null (bool_and short-
  --    circuits to false the moment one unit_price is null).
  select case when bool_and(line.unit_price is not null) then sum(line.unit_price * line.qty) else null end
    into v_total
  from (
    select
      ((v.item ->> 'qty')::numeric)::int as qty,
      coalesce(
        (
          select o.offer_price
          from public.offers o
          where o.store_id = v_store_id
            and o.product_id = p.id
            and o.offer_date = public.today_ist()
          order by o.id
          limit 1
        ),
        p.price
      ) as unit_price
    from jsonb_array_elements(p_items) as v (item)
    join public.products p on p.id = (v.item ->> 'product_id')::uuid
  ) as line;

  -- k. insert the order and its items. product_name and the display price
  --    are copied from the store's own live rows — never from client input.
  insert into public.orders (store_id, customer_id, customer_name, customer_phone, note, total)
  values (v_store_id, v_customer_id, v_name, v_phone, v_note, v_total)
  returning id into v_order_id;

  insert into public.order_items (order_id, product_id, product_name, qty, price)
  select
    v_order_id,
    p.id,
    p.name,
    ((v.item ->> 'qty')::numeric)::int,
    (
      select o.today_price_label
      from public.offers o
      where o.store_id = v_store_id
        and o.product_id = p.id
        and o.offer_date = public.today_ist()
      order by o.id
      limit 1
    )
  from jsonb_array_elements(p_items) as v (item)
  join public.products p on p.id = (v.item ->> 'product_id')::uuid;

  -- l.
  return v_order_id;
end;
$$;

revoke all on function public.place_order(text, text, text, text, jsonb) from public;
grant execute on function public.place_order(text, text, text, text, jsonb) to anon, authenticated;

comment on function public.place_order(text, text, text, text, jsonb) is
  'Public order-request write path (the only way anon writes anything). '
  'Upserts a per-shop customers row keyed on (store_id, phone) and links the '
  'order to it; computes orders.total from each line''s today offer_price or '
  'product price, null when any line is unpriceable. Raises errcode P0001 '
  'with the message set to one of: store_not_found, store_closed, '
  'rate_limited, item_unavailable, invalid_name, invalid_phone, '
  'invalid_note, invalid_items, invalid_qty.';
