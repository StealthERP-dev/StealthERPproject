-- pgTAP: search_path / grant / volatility hardening for every function in
-- schemas public and private (PLAT-06, T-02-03, T-02-04). Queries pg_catalog
-- directly (not gated behind any role switch) — these are properties of the
-- functions themselves, not access-control outcomes that depend on caller role.
-- Extension-owned members (pg_depend deptype 'e') are excluded throughout so a
-- future extension (e.g. pgtap itself) never pollutes these counts.

begin;

select plan(12);

-- 1. every non-extension function in public/private has an empty search_path
-- (defense against search_path hijacking in security-definer functions, T-02-03)
select is(
  (
    select count(*)::int
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and not exists (
        select 1 from pg_catalog.pg_depend d
        where d.objid = p.oid and d.deptype = 'e'
      )
      and not (coalesce(p.proconfig, array[]::text[]) @> array['search_path=""'])
  ),
  0,
  'every function in public/private has search_path="" set'
);

-- 2. the only security-definer functions in schema public are log_event,
-- place_order and the three AUTH-06 login-lockout RPCs
select is(
  (
    select coalesce(array_agg(p.proname::text order by p.proname::text), array[]::text[])
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and not exists (
        select 1 from pg_catalog.pg_depend d
        where d.objid = p.oid and d.deptype = 'e'
      )
  ),
  array['check_login_lock', 'clear_login_attempts', 'log_event', 'place_order', 'record_login_failure']::text[],
  'check_login_lock, clear_login_attempts, log_event, place_order and record_login_failure are the only security-definer functions in schema public'
);

-- 3. no security-definer function (public or private) grants EXECUTE to PUBLIC
-- (grantee 0) — Postgres defaults to PUBLIC-executable, so this must be explicit
select is(
  (
    select count(*)::int
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    join lateral pg_catalog.aclexplode(p.proacl) a on true
    where n.nspname in ('public', 'private')
      and p.prosecdef
      and a.grantee = 0
      and not exists (
        select 1 from pg_catalog.pg_depend d
        where d.objid = p.oid and d.deptype = 'e'
      )
  ),
  0,
  'no security-definer function in public/private grants EXECUTE to PUBLIC'
);

-- 4. anon cannot execute the internal owner-lookup helper
select is(
  has_function_privilege('anon', 'private.owned_store_id()', 'execute'),
  false,
  'anon cannot execute private.owned_store_id()'
);

-- 5. anon CAN execute both intentional public RPCs
select is(
  has_function_privilege('anon', 'public.place_order(text,text,text,text,jsonb)', 'execute'),
  true,
  'anon can execute public.place_order(text,text,text,text,jsonb)'
);

-- 6. today_ist() stays STABLE, never IMMUTABLE (Pitfall 2 — re-asserted here
-- alongside the rest of the hardening surface; also asserted in 010)
select volatility_is('public', 'today_ist', 'stable', 'today_ist() is STABLE, never IMMUTABLE');

-- 7. public_stores keeps security_invoker=true (Pitfall 1 — PostgREST's RLS-aware
-- query path must stay in effect, never revert to the view creator's privileges)
select ok(
  exists (
    select 1 from pg_catalog.pg_class
    where relname = 'public_stores' and 'security_invoker=true' = any(reloptions)
  ),
  'public.public_stores view has security_invoker=true'
);

-- 8. anon CAN execute the second intentional public RPC
select is(
  has_function_privilege('anon', 'public.log_event(text,text,text,text,uuid,uuid,uuid,jsonb)', 'execute'),
  true,
  'anon can execute public.log_event(text,text,text,text,uuid,uuid,uuid,jsonb)'
);

-- 9. anon CAN execute the login-lockout pre-flight gate
select is(
  has_function_privilege('anon', 'public.check_login_lock(text)', 'execute'),
  true,
  'anon can execute public.check_login_lock(text)'
);

-- 10. anon CAN execute the login-failure recorder
select is(
  has_function_privilege('anon', 'public.record_login_failure(text)', 'execute'),
  true,
  'anon can execute public.record_login_failure(text)'
);

-- 11. anon CANNOT execute the login-attempts clearer — it takes no phone
-- argument and derives the caller's own phone from their session, so
-- granting anon execute here would let an unauthenticated caller clear any
-- phone's lock and defeat AUTH-06 entirely (see the migration's comment).
select is(
  has_function_privilege('anon', 'public.clear_login_attempts()', 'execute'),
  false,
  'anon cannot execute public.clear_login_attempts()'
);

-- 12. authenticated CAN execute the login-attempts clearer
select is(
  has_function_privilege('authenticated', 'public.clear_login_attempts()', 'execute'),
  true,
  'authenticated can execute public.clear_login_attempts()'
);

select * from finish();

rollback;
