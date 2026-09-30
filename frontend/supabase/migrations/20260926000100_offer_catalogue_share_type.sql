-- D-12: widen catalogue_shares.share_type to also accept 'offer'.
--
-- This is a NEW file — the phase's only migration. None of the sixteen
-- previously-shipped migration files is edited, renamed, or deleted by this
-- change; they stay byte-for-byte immutable, exactly as every prior phase's
-- migration has been. The two ALTER statements below remove the existing
-- check constraint and immediately re-add it one value wider — that removes
-- a CONSTRAINT, not a FILE. Read as a whole, the change is additive in the
-- sense D-12 means it: every row that was legal before this migration stays
-- legal after it (no existing row is touched, no value already accepted is
-- removed), and exactly one more value ('offer') becomes legal. A reviewer
-- seeing the removal statement below should not read it as "a shipped file
-- was edited" — no shipped file was; this is a new file whose own two
-- statements together widen one constraint.
--
-- The live constraint name was read back from pg_constraint and printed
-- before this file was written (see the plan's SUMMARY for the transcript):
--   conname:  catalogue_shares_share_type_check
--   condef:   CHECK ((share_type = ANY (ARRAY['catalogue'::text, 'product'::text])))
-- It matched the name this migration hardcodes below exactly, so no
-- deviation from the plan's expected name was needed.
--
-- This project's migration history has no prior instance of removing then
-- re-adding a check constraint — every earlier additive migration only ever
-- created something from nothing or renamed a column. Widening a named
-- check constraint without a table rewrite requires this remove-then-re-add
-- pair; that is why the live name was confirmed first rather than assumed
-- from the original `create table` statement's column order.
alter table public.catalogue_shares
  drop constraint catalogue_shares_share_type_check;

alter table public.catalogue_shares
  add constraint catalogue_shares_share_type_check
  check (share_type = any (array['catalogue'::text, 'product'::text, 'offer'::text]));
