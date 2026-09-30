-- Phase 01.1 code-review fixes (01.1-REVIEW.md WR-01, WR-02, WR-03).
--
-- WR-02: log_event bounded none of its text/jsonb inputs, while place_order
--        bounds every string it accepts. The rate limit caps how OFTEN an
--        actor writes, not how MUCH, so a public caller could grow storage
--        with oversized props. Oversized input is trimmed away rather than
--        raised on: this endpoint's contract (D-04/D-05) is that a caller
--        never sees an error from analytics.
-- WR-01: p_offer_id was stored verbatim while p_product_id and p_order_id
--        are re-resolved against the caller's own store. Same treatment now:
--        an offer id from another store resolves to null rather than being
--        recorded against this store's events.
-- WR-03: catalogue_shares checked store ownership but not that product_id
--        belongs to that same store, so a vendor could record a share
--        against another shop's product and corrupt their own analytics.

create or replace function public.log_event(
  p_event_name  text,
  p_slug        text default null,
  p_visitor_id  text default null,
  p_app_version text default null,
  p_product_id  uuid default null,
  p_order_id    uuid default null,
  p_offer_id    uuid default null,
  p_props       jsonb default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_store_id      uuid;
  v_user_id       uuid;
  v_visitor_id    text;
  v_customer_id   uuid;
  v_product_id    uuid;
  v_offer_id      uuid;
  v_product_name  text;
  v_store_name    text;
  v_app_version   text;
  v_props         jsonb;
  v_actor_key     text;
  v_lock_key      bigint;
  v_recent_count  int;
begin
  -- a. allow-list: exact string equality against the 17-name contract — a
  --    name differing by case or a trailing space is rejected, not coerced.
  --    This is the one case that raises: a bad name is a caller bug, not
  --    "too many legitimate events", and letting it through would silently
  --    create an event type nobody agreed to (D-02).
  if p_event_name is null or p_event_name not in (
    'shop_created', 'onboarding_completed', 'product_added', 'product_updated',
    'product_marked_available', 'product_marked_unavailable', 'offer_created',
    'offer_shared', 'catalogue_shared', 'catalogue_opened', 'product_viewed',
    'add_to_cart', 'checkout_started', 'order_placed', 'order_cancelled',
    'order_confirmed', 'orders_opened'
  ) then
    raise exception 'invalid_event_name' using errcode = 'P0001';
  end if;

  -- a2. (WR-02) input bounds. Analytics must never raise at a caller, so an
  --     over-long value is discarded, not rejected: a slug longer than any
  --     real slug cannot match a store anyway, an over-long visitor id is
  --     treated as absent (the call then no-ops on the anon branch), an
  --     over-long version is stored as null rather than truncated to a
  --     misleading string, and over-large props are dropped while the event
  --     itself is still recorded.
  if p_slug is not null and pg_catalog.length(p_slug) > 100 then
    p_slug := null;
  end if;
  if p_visitor_id is not null and pg_catalog.length(p_visitor_id) > 100 then
    p_visitor_id := null;
  end if;
  v_app_version := p_app_version;
  if v_app_version is not null and pg_catalog.length(v_app_version) > 50 then
    v_app_version := null;
  end if;
  if p_props is not null and pg_catalog.length(p_props::text) > 2000 then
    p_props := null;
  end if;

  -- b. attribution: a signed-in vendor's store_id/user_id are always derived
  --    server-side from auth.uid()/private.owned_store_id() — never accepted
  --    as parameters, or a vendor could inflate a rival's metrics or deflate
  --    their own. Otherwise the shop arrives as a slug resolved server-side,
  --    exactly as place_order does — never a raw store_id.
  if (select auth.uid()) is not null then
    v_user_id := (select auth.uid());
    v_store_id := private.owned_store_id();
  elsif p_slug is not null then
    select id into v_store_id from public.stores where slug = p_slug;
    v_visitor_id := p_visitor_id;
  end if;

  -- If neither branch yields an actor's shop, there is nothing to record.
  if v_store_id is null then
    return;
  end if;

  -- On the anonymous branch, a null visitor id means there is nothing to
  -- rate-limit against.
  if v_user_id is null and v_visitor_id is null then
    return;
  end if;

  -- c. serialize concurrent calls for the SAME actor before the rate-limit
  --    count — transaction-scoped, auto-releases on commit/rollback. The
  --    'log_event:' prefix is a deliberate divergence from place_order,
  --    which does not prefix its own key: pg_advisory_xact_lock shares one
  --    global 64-bit keyspace across the database, and namespacing by
  --    purpose is what stops two unrelated rate limits colliding.
  v_actor_key := 'log_event:' || coalesce(v_user_id::text, v_visitor_id);
  v_lock_key := pg_catalog.hashtextextended(v_actor_key, 0);
  perform pg_catalog.pg_advisory_xact_lock(v_lock_key);

  -- 60 events per actor per rolling minute. Strict '>' makes the window
  -- half-open, so a row exactly one minute old falls outside it.
  if v_user_id is not null then
    select count(*) into v_recent_count
      from public.events
      where user_id = v_user_id
        and occurred_at > now() - interval '1 minute';
  else
    select count(*) into v_recent_count
      from public.events
      where visitor_id = v_visitor_id
        and occurred_at > now() - interval '1 minute';
  end if;

  -- This is the single place where copying place_order verbatim would be
  -- wrong: place_order raises rate_limited because a customer needs to know
  -- their order did not go through; here the call must still resolve OK so
  -- a real user never sees an error (D-04) — a plain return, no raise.
  if v_recent_count >= 60 then
    return;
  end if;

  -- d. best-effort entity resolution, which never rejects. Each entity id is
  --    kept only if it names a row in the resolved store, otherwise null —
  --    (WR-01) p_offer_id now gets the same treatment p_product_id and
  --    p_order_id already had. customer_id is derived server-side from
  --    p_order_id — never accepted as a parameter.
  if p_product_id is not null then
    select id, name into v_product_id, v_product_name
      from public.products
      where id = p_product_id and store_id = v_store_id;
  end if;

  if p_order_id is not null then
    select customer_id into v_customer_id
      from public.orders
      where id = p_order_id and store_id = v_store_id;
  end if;

  if p_offer_id is not null then
    select id into v_offer_id
      from public.offers
      where id = p_offer_id and store_id = v_store_id;
  end if;

  select shop_name into v_store_name from public.stores where id = v_store_id;

  -- e. name snapshots for D-07: merge server-resolved names into props so a
  --    past event still identifies a deleted product/store by name. Never
  --    trust a client-supplied name — both are read from the store's own
  --    live rows above, never from p_props.
  v_props := coalesce(p_props, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
    'product_name', v_product_name,
    'store_name', v_store_name
  ));

  -- f.
  insert into public.events (
    event_name, store_id, user_id, customer_id, visitor_id,
    product_id, order_id, offer_id, app_version, props
  ) values (
    p_event_name, v_store_id, v_user_id, v_customer_id, v_visitor_id,
    v_product_id, p_order_id, v_offer_id, v_app_version, v_props
  );
end;
$$;

revoke all on function public.log_event(text, text, text, text, uuid, uuid, uuid, jsonb) from public;
grant execute on function public.log_event(text, text, text, text, uuid, uuid, uuid, jsonb) to anon, authenticated;

-- WR-03: a share may only name a product from the sharing vendor's own store.
-- Enforced by a security-definer trigger rather than a CHECK constraint: a
-- CHECK that queries another table is not a true row invariant (Postgres may
-- not re-evaluate it when the referenced row changes), and the constraint
-- would run as the inserting role, which cannot read the helper. The trigger
-- holds for every writer, including future server-side paths.
create or replace function private.enforce_share_product_store()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if new.product_id is not null
     and not exists (
       select 1 from public.products
       where id = new.product_id and store_id = new.store_id
     ) then
    raise exception 'product_not_in_store' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_share_product_store() from public, anon, authenticated;

create trigger catalogue_shares_product_in_store
before insert or update on public.catalogue_shares
for each row execute function private.enforce_share_product_store();
