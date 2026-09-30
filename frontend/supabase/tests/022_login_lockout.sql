-- pgTAP: the AUTH-06 login lockout surface — hardening, the 15-minute window,
-- the exact fifth-attempt boundary, empty-input handling, phone
-- canonicalisation, and clear_login_attempts's authenticated-only scope
-- (including the regression assertion for the anon-bypass this migration's
-- Task 1 follow-up commit closed: clear_login_attempts takes no phone
-- argument and is refused for an unauthenticated caller).
--
-- The vendored time-freezing test helper is deliberately NOT used here
-- (Pitfall 2, 02-RESEARCH.md): it cannot reach inside a function whose
-- search_path is the empty string. The window is proven instead with
-- directly backdated attempted_at rows, inserted as the privileged test
-- role (bypasses RLS/grants, same fixture style 013/021 use).

begin;

select plan(40);

-- ── Fixture: a real signed-in vendor for the clear_login_attempts section ──
select tests.create_supabase_user('vendor_lockout_clear', '9800000805@phone.local');

-- ── Section A: hardening (1-18) ─────────────────────────────────────────────

select has_table('private', 'login_attempts', 'private.login_attempts exists');
select has_column('private', 'login_attempts', 'id', 'login_attempts has an id column');
select col_type_is('private', 'login_attempts', 'id', 'uuid', 'login_attempts.id is uuid');
select has_column('private', 'login_attempts', 'phone', 'login_attempts has a phone column');
select col_type_is('private', 'login_attempts', 'phone', 'text', 'login_attempts.phone is text');
select has_column('private', 'login_attempts', 'attempted_at', 'login_attempts has an attempted_at column');
select col_type_is('private', 'login_attempts', 'attempted_at', 'timestamp with time zone', 'login_attempts.attempted_at is timestamptz');

select is(
  (select prosecdef from pg_catalog.pg_proc where proname = 'check_login_lock' and pronamespace = 'public'::regnamespace),
  true,
  'check_login_lock is security definer'
);
select is(
  (select prosecdef from pg_catalog.pg_proc where proname = 'record_login_failure' and pronamespace = 'public'::regnamespace),
  true,
  'record_login_failure is security definer'
);
select is(
  (select prosecdef from pg_catalog.pg_proc where proname = 'clear_login_attempts' and pronamespace = 'public'::regnamespace),
  true,
  'clear_login_attempts is security definer'
);

select is(
  (
    select count(*)::int
    from pg_catalog.pg_proc
    where proname in ('check_login_lock', 'record_login_failure', 'clear_login_attempts')
      and pronamespace = 'public'::regnamespace
      and coalesce(proconfig, array[]::text[]) @> array['search_path=""']
  ),
  3,
  'all three lockout functions have search_path="" set'
);

select is(
  has_function_privilege('anon', 'public.check_login_lock(text)', 'execute'),
  true,
  'anon can execute public.check_login_lock(text)'
);
select is(
  has_function_privilege('anon', 'public.record_login_failure(text)', 'execute'),
  true,
  'anon can execute public.record_login_failure(text)'
);
select is(
  has_function_privilege('anon', 'public.clear_login_attempts()', 'execute'),
  false,
  'anon cannot execute public.clear_login_attempts() — it derives the phone from the caller''s own session'
);
select is(
  has_function_privilege('authenticated', 'public.clear_login_attempts()', 'execute'),
  true,
  'authenticated can execute public.clear_login_attempts()'
);

select ok(
  not has_table_privilege('anon', 'private.login_attempts', 'select')
    and not has_table_privilege('anon', 'private.login_attempts', 'insert')
    and not has_table_privilege('anon', 'private.login_attempts', 'update')
    and not has_table_privilege('anon', 'private.login_attempts', 'delete'),
  'anon holds no select/insert/update/delete privilege on private.login_attempts'
);

select volatility_is('public', 'check_login_lock', 'stable', 'check_login_lock() is STABLE');
select volatility_is('public', 'record_login_failure', 'volatile', 'record_login_failure() is VOLATILE');

-- ── Section B: the 15-minute window, via backdated rows only (19-20) ───────

insert into private.login_attempts (phone, attempted_at)
select '9800000801', now() - interval '20 minutes' from generate_series(1, 5);

select is(
  public.check_login_lock('9800000801'),
  false,
  'five rows 20 minutes old are entirely outside the 15-minute window'
);

-- Half-open edge: a row at exactly 15 minutes old is still outside, because
-- the comparison inside check_login_lock/record_login_failure is strictly
-- greater-than (attempted_at > now() - interval '15 minutes').
insert into private.login_attempts (phone, attempted_at)
select '9800000802', now() - interval '15 minutes' from generate_series(1, 5);

select is(
  public.check_login_lock('9800000802'),
  false,
  'five rows exactly 15 minutes old are outside the half-open window (strictly greater-than)'
);

-- ── Section C: the exact fifth-attempt boundary and the self-sweep (21-29) ──

select is(public.record_login_failure('9800000803'), false, 'attempt 1 does not trip the lock');
select is(public.record_login_failure('9800000803'), false, 'attempt 2 does not trip the lock');
select is(public.record_login_failure('9800000803'), false, 'attempt 3 does not trip the lock');
select is(public.record_login_failure('9800000803'), false, 'attempt 4 does not trip the lock');
select is(
  public.check_login_lock('9800000803'),
  false,
  'four failures leave the phone unlocked'
);
select is(public.record_login_failure('9800000803'), true, 'attempt 5 trips the lock');
select is(
  public.check_login_lock('9800000803'),
  true,
  'check_login_lock turns true the instant the fifth failure lands'
);
select is(public.record_login_failure('9800000803'), true, 'attempt 6 still reports locked');

insert into private.login_attempts (id, phone, attempted_at) values
  ('00000000-0000-4000-8000-000000000029', '9800000803', now() - interval '20 minutes');
select public.record_login_failure('9800000803');
select ok(
  not exists (select 1 from private.login_attempts where id = '00000000-0000-4000-8000-000000000029'),
  'record_login_failure sweeps this phone''s own stale rows before inserting'
);

-- ── Section D: empty / null / digit-free input (30-35) ──────────────────────

select is(public.record_login_failure(''), false, 'record_login_failure('''') returns false');
select is(public.record_login_failure(null), false, 'record_login_failure(null) returns false');
select is(public.record_login_failure('no-digits-here'), false, 'record_login_failure(''no-digits-here'') returns false');
select is(public.check_login_lock(''), false, 'check_login_lock('''') returns false');
select is(public.check_login_lock(null), false, 'check_login_lock(null) returns false');
select is(
  (select count(*)::int from private.login_attempts where phone = ''),
  0,
  'no row was inserted for any empty/null/digit-free phone'
);

-- ── Section E: canonicalisation — punctuation never changes identity (36) ──

select public.record_login_failure('+91 98000-00901');
select public.record_login_failure('+91-98000-00901');
select public.record_login_failure(' +919800000901 ');
select public.record_login_failure('(91) 98000 00901');
select public.record_login_failure('919800000901');

select is(
  public.check_login_lock('919800000901'),
  true,
  'five failures recorded with varied spacing/dashes/plus-sign formatting lock the same digits-only identity'
);

-- ── Section F: clear_login_attempts is authenticated-only (37-40) ───────────
-- The caller's own phone is derived from auth.users.email's local part
-- (synthetic email <digits>@phone.local), never from a parameter — see the
-- migration's comment for why a phone parameter here would be an AUTH-06
-- bypass (any anon caller could unlock any number).

insert into private.login_attempts (phone, attempted_at)
select '9800000805', now() from generate_series(1, 5);
insert into private.login_attempts (phone, attempted_at)
select '9800000806', now() from generate_series(1, 3);

select tests.authenticate_as('vendor_lockout_clear');

select lives_ok(
  $$ select public.clear_login_attempts() $$,
  'an authenticated vendor can call clear_login_attempts() for their own session'
);

-- Return to the session's original (superuser) role to inspect
-- private.login_attempts directly — neither authenticated nor service_role
-- holds SELECT on this table or USAGE on the private schema (by design,
-- only the security-definer functions may touch it), so `reset role`
-- rather than `tests.authenticate_as_service_role()` is what actually
-- restores read access here.
reset role;

select is(
  (select count(*)::int from private.login_attempts where phone = '9800000805'),
  0,
  'clear_login_attempts removed every row for the caller''s own phone'
);
select is(
  (select count(*)::int from private.login_attempts where phone = '9800000806'),
  3,
  'a different phone''s rows are untouched by another vendor''s clear_login_attempts call'
);

select tests.clear_authentication();

select throws_ok(
  $$ select public.clear_login_attempts() $$,
  '42501',
  null,
  'anon cannot execute clear_login_attempts() (permission denied) — the AUTH-06 bypass regression test'
);

select * from finish();

rollback;
