-- Phase 01.1 (beta data): offers numeric price model (D-01, D-08, D-16).
-- Additive-only migration — Phase 1's four migration files are never edited
-- (D-08); this ALTERs the existing public.offers table and ADDs new columns
-- and constraints. Every reference is schema-qualified.
--
-- D-16: the two legacy free-typed display columns (a rupee-per-kilo string
-- like '₹40/kg') are renamed, never cast. No cast can safely reinterpret a
-- vendor's own display text as a number, so the rename frees the doc's own
-- field names (offer_price/regular_price) for the new numeric columns added
-- below, while the original string values survive byte-for-byte under their
-- *_label names.

alter table public.offers rename column today_price to today_price_label;
alter table public.offers rename column regular_price to regular_price_label;

-- ── Numeric price model (doc §1) ─────────────────────────────────────────────
-- Separate `alter table` statements per group: a generated column cannot
-- reference a sibling column added in the same `alter table` command.

-- Group 1: plain columns. offer_price is deliberately nullable with NO
-- default — diverging from RESEARCH.md's draft (`not null default 0`).
-- No screen writes offer_price until OFFR-01 ships in Phase 5; a default of
-- 0 would make a later `orders.total` computation report a real order as
-- costing nothing instead of correctly reporting "not priceable".
alter table public.offers add column created_at timestamptz not null default now();
alter table public.offers add column offer_price numeric check (offer_price is null or offer_price >= 0);
alter table public.offers add column regular_price numeric;

-- Group 2: cross-column check, added once both numeric columns exist.
alter table public.offers add constraint offers_regular_price_gte_offer_price
  check (regular_price is null or offer_price is null or regular_price >= offer_price);

-- Group 3: exact decimal saving (Postgres numeric — no float/double cast).
alter table public.offers add column saving numeric generated always as (
  case when regular_price is not null and offer_price is not null
    then regular_price - offer_price
    else null
  end
) stored;

-- Group 4: IST-derived half-open window, generated from offer_date so it can
-- never drift from public.today_ist(). Both expressions must be IMMUTABLE —
-- `offer_date::timestamptz` is only STABLE (depends on session TimeZone) and
-- would make this `alter table` fail with "generation expression is not
-- immutable"; casting to `timestamp` first, then applying `at time zone` with
-- a literal constant, is immutable.
alter table public.offers add column starts_at timestamptz generated always as (
  (offer_date::timestamp) at time zone 'Asia/Kolkata'
) stored;
alter table public.offers add column ends_at timestamptz generated always as (
  ((offer_date + 1)::timestamp) at time zone 'Asia/Kolkata'
) stored;

-- One live offer per product per day (closes 01-REVIEW WR-02): a second
-- insert for the same (product_id, offer_date) is rejected by the database,
-- not assumed by every reader.
alter table public.offers add constraint offers_product_id_offer_date_key
  unique (product_id, offer_date);
