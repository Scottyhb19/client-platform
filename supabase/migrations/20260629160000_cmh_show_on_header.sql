-- ============================================================================
-- 20260629160000_cmh_show_on_header
-- ============================================================================
-- Why: The Profile rework replaces the medical-history "severity" field with a
-- per-condition Tag / No-tag choice that controls whether a condition appears
-- as a chip on the client's sticky header. This column persists that choice.
--
-- Default true (Tag): existing conditions keep showing on the header exactly as
-- before — the header used to show the first two ACTIVE conditions, and with
-- every row defaulting to tagged the visible result is unchanged until the EP
-- explicitly un-tags one. New conditions default to tagged.
--
-- Additive + NOT NULL with a DEFAULT, so this is safe to push to the live
-- shared DB ahead of the matching frontend: the deployed frontend never selects
-- this column, and existing/!new inserts get the default. No rename-style
-- mismatch window (unlike 20260629150000). Push the migration first, then
-- deploy the frontend that reads show_on_header.
--
-- The `severity` column is intentionally left in place but dormant — the app no
-- longer reads or writes it (removed from the loader, types, dialog, row, and
-- header). Dropping it would also mean rewriting pgTAP 19's fixture (which
-- inserts severity) and is a destructive change for no functional gain; a later
-- cleanup migration can drop it if desired.
--
-- No new RLS or audit surface: client_medical_history already has staff-only
-- RLS and a whole-row audit trigger, both of which cover a new column. So no
-- new policy, no audit-resolver change, no new pgTAP gate (same posture as
-- 20260625140000_clients_overdue_followed_up_at).
-- ============================================================================

ALTER TABLE client_medical_history
  ADD COLUMN show_on_header boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN client_medical_history.show_on_header IS
  'Whether this condition appears as a chip on the client header (the Profile "Tag / No-tag" choice). Default true. Replaces the retired severity field as the header-relevance signal.';


-- ============================================================================
-- §ROLLBACK (down reversal) — Supabase migrations are forward-only; run this in
-- the SQL Editor (or as a follow-up migration) to drop the column. Lossless to
-- the rest of the row.
-- ----------------------------------------------------------------------------
-- ALTER TABLE client_medical_history DROP COLUMN show_on_header;
-- ============================================================================
