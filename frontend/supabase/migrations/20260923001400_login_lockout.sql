-- Phase 2 (shop setup & login): AUTH-06 per-phone PIN lockout (D-01a, D-02).
-- private.login_attempts + three public RPCs, modelled on place_order's and
-- log_event's hardening pattern: security definer, search_path = '', fully
-- qualified names, advisory-lock-before-count. The table lives in `private`,
-- which is absent from config.toml's [api].schemas, so PostgREST cannot
-- reach it and no RLS policy is needed to keep the advisors gate clean.
--
-- Deliberate divergence from log_event: log_event returns silently once its
-- rate limit trips because analytics must never surface an error to a real
-- user. These functions do the opposite — the vendor must be told they are
-- locked out, so check_login_lock/record_login_failure return values the
-- caller branches on.

create table private.login_attempts (
  id           uuid primary key default gen_random_uuid(),
  phone        text not null,
  attempted_at timestamptz not null default now()
);

create index login_attempts_phone_attempted_at_idx
  on private.login_attempts (phone, attempted_at desc);

-- Pre-flight gate: called BEFORE signInWithPassword, so a locked phone never
-- reaches Supabase Auth even with the correct PIN on attempt #6+.
create function public.check_login_lock(p_phone text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select count(*) >= 5
  from private.login_attempts
  where phone = regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g')
    and attempted_at > now() - interval '15 minutes';
$$;

revoke all on function public.check_login_lock(text) from public;
grant execute on function public.check_login_lock(text) to anon, authenticated;

comment on function public.check_login_lock(text) is
  'Pre-flight lockout gate (AUTH-06). Returns true when the given phone has '
  'accumulated 5 or more failures inside the trailing 15-minute window. '
  'Must be called before signInWithPassword — the lock is enforced by the '
  'caller skipping the sign-in attempt entirely, not by this function alone.';

-- Called after signInWithPassword returns invalid_credentials. Returns true
-- exactly when THIS failure is the one that trips the lock, so the UI can
-- show the D-03 message immediately without a second round trip.
create function public.record_login_failure(p_phone text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_phone    text;
  v_lock_key bigint;
  v_count    int;
begin
  v_phone := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  if v_phone = '' then
    return false;
  end if;

  -- Serialize concurrent calls for the SAME phone before the rate-limit
  -- count — transaction-scoped, auto-releases on commit/rollback. The
  -- 'login_attempt:' prefix keeps this keyspace disjoint from place_order's
  -- unprefixed keys and log_event's 'log_event:'-prefixed keys.
  v_lock_key := pg_catalog.hashtextextended('login_attempt:' || v_phone, 0);
  perform pg_catalog.pg_advisory_xact_lock(v_lock_key);

  -- Self-cleaning: sweep this phone's own stale rows before inserting, so a
  -- phone that keeps retrying never accumulates unbounded rows.
  delete from private.login_attempts
    where phone = v_phone and attempted_at < now() - interval '15 minutes';

  insert into private.login_attempts (phone) values (v_phone);

  select count(*) into v_count
    from private.login_attempts
    where phone = v_phone and attempted_at > now() - interval '15 minutes';

  return v_count >= 5;
end;
$$;

-- ACCEPTED RISK, do not "fix": record_login_failure stays callable by anon
-- with an arbitrary phone argument, so an attacker who knows a victim's
-- phone number can lock it for 15 minutes by calling this 5 times. This is
-- NOT a new hole — the exact same outcome is achievable by typing 5 wrong
-- PINs into the real login form, which requires no privileged access at
-- all. Per-phone lockout (D-02) was deliberately chosen over per-device,
-- and this DoS-vs-availability tradeoff is inherent to any identifier-keyed
-- lockout scheme (documented OWASP tradeoff, T-02-04 in the phase's threat
-- register). Closing it properly needs a proof-of-failure token or a
-- server-side Auth hook, and this project has no backend/edge functions by
-- design (PRD S2) — over-engineering against the user's standing "simple,
-- industry standard" instruction for this phase. This is distinct from the
-- clear_login_attempts bypass above: that one let an attacker defeat the
-- lock silently with no trace and no cost; this one only ever reproduces
-- what the public login form already allows.
revoke all on function public.record_login_failure(text) from public;
grant execute on function public.record_login_failure(text) to anon, authenticated;

comment on function public.record_login_failure(text) is
  'Records one failed sign-in attempt for the given phone (AUTH-06). Returns '
  'true when this call is the one that trips the 5-in-15-minutes lock, false '
  'otherwise (including for an empty/null/digit-free phone, which records '
  'nothing). Sweeps the phone''s own stale rows before inserting.';

-- Called after a SUCCESSFUL sign-in, so earlier mistakes don't carry over
-- and trip the lock on one more typo minutes later.
-- The phone is deliberately NOT a parameter. If it were, any unauthenticated
-- caller holding only the public anon key could call
-- clear_login_attempts({p_phone: '<victim phone>'}) after every 4 wrong
-- PINs and the 5-in-15-minutes lock would never trip — a total bypass of
-- AUTH-06, not a hardening nit. Only a signed-in vendor may clear attempts,
-- and only for their own phone, so the phone is derived server-side from the
-- caller's own JWT (auth.uid() -> auth.users.email's local part, which is
-- exactly the canonical digits stored in private.login_attempts.phone,
-- since the synthetic email is `<digits>@phone.local`). A null auth.uid()
-- (anon caller) makes the subselect null and the delete matches zero rows —
-- safe by construction, no branch needed. anon holds no execute privilege on
-- this function at all; only authenticated does.
create function public.clear_login_attempts()
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  delete from private.login_attempts
  where phone = (
    select pg_catalog.split_part(email, '@', 1)
    from auth.users
    where id = (select auth.uid())
  );
$$;

revoke all on function public.clear_login_attempts() from public, anon;
grant execute on function public.clear_login_attempts() to authenticated;

comment on function public.clear_login_attempts() is
  'Clears every recorded failure for the caller''s own phone (AUTH-06), '
  'called after a successful sign-in so earlier mistakes do not carry over. '
  'Takes no parameter and is executable only by authenticated — the phone '
  'is derived from the caller''s own session (auth.uid() -> auth.users.email)'
  ' so an anon caller can never clear another phone''s lock, which would '
  'otherwise be a full AUTH-06 bypass.';
