-- Phase 01.1 (beta data): log_event, the second and final intentional public
-- RPC (DATA-02, D-01..D-05). Modelled on place_order's hardening pattern —
-- security definer, search_path = '', fully qualified names, an advisory-
-- lock rate limit — but diverges in exactly one place: over the rolling-
-- minute limit it does a plain `return;` rather than raising, so a real user
-- never sees an error and a public link cannot be used to flood the table
-- (D-04). The only case that raises is an unknown event_name — a caller bug,
-- never a legitimate-traffic condition (D-02).

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
  v_product_name  text;
  v_store_name    text;
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
    'add_to_cart', 'checkout_started', 'order_placed', 'order_confirmed',
    'order_cancelled', 'orders_opened'
  ) then
    raise exception 'invalid_event_name' using errcode = 'P0001';
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

  -- d. best-effort entity resolution, which never rejects. p_product_id is
  --    kept only if it names a product in the resolved store, otherwise
  --    null. customer_id is derived server-side from p_order_id — never
  --    accepted as a parameter. p_order_id and p_offer_id are passed
  --    through as-is.
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
    v_product_id, p_order_id, p_offer_id, p_app_version, v_props
  );
end;
$$;

revoke all on function public.log_event(text, text, text, text, uuid, uuid, uuid, jsonb) from public;
grant execute on function public.log_event(text, text, text, text, uuid, uuid, uuid, jsonb) to anon, authenticated;

comment on function public.log_event(text, text, text, text, uuid, uuid, uuid, jsonb) is
  'Fire-and-forget event logger (the only way anon/authenticated writes to '
  'public.events). Raises errcode P0001 with message invalid_event_name when '
  'p_event_name is not on the fixed 17-name allow-list; every other '
  'rejection — no resolvable actor, or over the 60-per-actor-per-minute rate '
  'limit — is a silent drop that still resolves OK.';
